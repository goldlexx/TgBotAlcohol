$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$Host.UI.RawUI.WindowTitle = 'TgBotAlcohol - secure setup'

function Invoke-Telegram($Method, $Body = @{}) {
    $uri = 'https://api.telegram.org/bot' + $token + '/' + $Method
    $result = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $Body -Compress) -TimeoutSec 30
    if (!$result.ok) { throw 'Telegram rejected the operation.' }
    return $result.result
}

$root = Split-Path $PSScriptRoot -Parent
$statusPath = Join-Path $root '.wrangler/telegram-setup.json'
$stage = 'configuration'

try {
    [void][IO.Directory]::CreateDirectory((Split-Path $statusPath -Parent))
    '{"status":"waiting"}' | Set-Content -LiteralPath $statusPath -Encoding ASCII
    $config = Get-Content -LiteralPath (Join-Path $root 'wrangler.test.local.jsonc') -Raw | ConvertFrom-Json
    if ($config.name -ne 'tgbot-alcohol' -or $config.vars.CLOSED_TEST -ne '1') { throw 'Invalid test configuration.' }

    $oauthPath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'xdg.config/.wrangler/config/default.toml'
    $oauth = [regex]::Match([IO.File]::ReadAllText($oauthPath), '(?m)^oauth_token\s*=\s*"([^"]+)"')
    if (!$oauth.Success) { throw 'Wrangler OAuth is unavailable.' }
    $headers = @{ Authorization = 'Bearer ' + $oauth.Groups[1].Value }
    $accountUrl = 'https://api.cloudflare.com/client/v4/accounts/' + $config.account_id
    $stage = 'Workers endpoint'
    $subdomain = Invoke-RestMethod -Uri "$accountUrl/workers/subdomain" -Headers $headers -TimeoutSec 20
    if (!$subdomain.success -or $subdomain.result.subdomain -notmatch '^[a-z0-9-]+$') { throw 'Workers subdomain is unavailable.' }
    $origin = 'https://' + $config.name + '.' + $subdomain.result.subdomain + '.workers.dev'

    $stage = 'Telegram token'
    $secretInput = Read-Host 'Paste the BotFather token here (hidden), then press Enter' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretInput)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secretInput.Dispose() }
    if ($token -notmatch '^[0-9]{5,16}:[A-Za-z0-9_-]{20,100}$') { throw 'Invalid token format.' }

    $bot = Invoke-Telegram 'getMe'
    if (!$bot.is_bot -or $bot.username -notmatch '^[A-Za-z0-9_]+$') { throw 'Invalid bot identity.' }
    Write-Host ('Test bot: @' + $bot.username)
    if ((Invoke-Telegram 'getWebhookInfo').url) { throw 'The bot already has a webhook.' }

    $stage = 'test chat'
    $requestedId = (Read-Host 'Your numeric Telegram ID, or Enter to detect it from your private chat').Trim()
    if ($requestedId -and $requestedId -notmatch '^[1-9][0-9]{0,15}$') { throw 'Invalid Telegram chat ID.' }
    $proof = '/start setup_' + [Guid]::NewGuid().ToString('N')
    Write-Host ('Send the following line to @' + $bot.username + ' in a private chat within 10 minutes:')
    Write-Host $proof
    $offset = 0
    $deadline = [DateTime]::UtcNow.AddMinutes(10)
    $chat = $null
    while (!$chat -and [DateTime]::UtcNow -lt $deadline) {
        $updates = Invoke-Telegram 'getUpdates' @{ offset = $offset; timeout = 10; allowed_updates = @('message') }
        foreach ($update in $updates) {
            if ($update.message.text -eq $proof -and $update.message.chat.type -eq 'private' -and
                $update.message.chat.id -eq $update.message.from.id -and
                (!$requestedId -or $requestedId -eq [string]$update.message.chat.id)) {
                $chat = [string]$update.message.chat.id
                break
            }
            $offset = [long]$update.update_id + 1
        }
    }
    if (!$chat -or $chat -notmatch '^[1-9][0-9]{0,15}$') { throw 'Test chat was not confirmed.' }

    $stage = 'Cloudflare secrets'
    $webhookSecret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $scriptUrl = "$accountUrl/workers/scripts/tgbot-alcohol"
    $secrets = @{ TELEGRAM_TOKEN = $token; WEBHOOK_SECRET = $webhookSecret; ALLOWED_CHAT_IDS = $chat }
    foreach ($name in $secrets.Keys) {
        $payload = @{ name = $name; text = $secrets[$name]; type = 'secret_text' } | ConvertTo-Json -Compress
        $reply = Invoke-RestMethod -Uri "$scriptUrl/secrets" -Method Put -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 30
        if (!$reply.success) { throw 'Secret update failed.' }
    }

    $stage = 'private health check'
    try {
        $probe = Invoke-RestMethod -Uri "$origin/health" -Headers @{ 'X-Telegram-Bot-Api-Secret-Token' = $webhookSecret } -TimeoutSec 10
    } catch [System.Net.WebException] {
        if ($_.Exception.Status -ne [System.Net.WebExceptionStatus]::NameResolutionFailure) { throw }
        $hostname = ([uri]$origin).Host
        $lookup = Invoke-RestMethod -Uri "https://cloudflare-dns.com/dns-query?name=$hostname&type=A" -Headers @{ Accept = 'application/dns-json' } -TimeoutSec 10
        $ip = $lookup.Answer | Where-Object type -eq 1 | Select-Object -First 1 -ExpandProperty data
        if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Worker address is unavailable.' }
        $header = 'header = "X-Telegram-Bot-Api-Secret-Token: ' + $webhookSecret + '"'
        $response = $header | curl.exe --config - --noproxy '*' --resolve "${hostname}:443:$ip" --silent --fail --max-time 15 "$origin/health"
        if ($LASTEXITCODE -ne 0) { throw 'Private health check failed.' }
        $probe = $response | ConvertFrom-Json
    }
    if (!$probe.ok) { throw 'Private health check failed.' }

    $stage = 'Telegram webhook'
    $hook = "$origin/telegram/webhook"
    $registered = Invoke-Telegram 'setWebhook' @{ url = $hook; secret_token = $webhookSecret; allowed_updates = @('message', 'callback_query') }
    if (!$registered -or (Invoke-Telegram 'getWebhookInfo').url -ne $hook) { throw 'Webhook registration failed.' }
    '{"status":"connected"}' | Set-Content -LiteralPath $statusPath -Encoding ASCII
    Write-Host 'The test bot is connected. Telegram will deliver the pending /start to the Worker.'
}
catch {
    $http = ''
    if ($_.Exception.Response) { $http = ' HTTP ' + [int]$_.Exception.Response.StatusCode }
    @{ status = 'failed'; stage = $stage; http = $http } | ConvertTo-Json -Compress | Set-Content -LiteralPath $statusPath -Encoding ASCII
    Write-Host ('Setup failed at: ' + $stage + '.' + $http)
    exit 1
}
finally {
    $token = $null
    $secrets = $null
    $payload = $null
}
