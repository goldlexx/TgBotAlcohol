param(
  [string]$BotToken
)

$ErrorActionPreference = 'Stop'

if (-not $BotToken) {
  $secure = Read-Host 'TELEGRAM_TOKEN (from BotFather, input hidden)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $BotToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $BotToken) { throw 'Empty TELEGRAM_TOKEN' }

function Invoke-Telegram([string]$Method, [hashtable]$Body = @{}) {
  $json = ($Body | ConvertTo-Json -Depth 5 -Compress)
  $res = Invoke-RestMethod -Uri "https://api.telegram.org/bot$BotToken/$Method" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
  if (-not $res.ok) { throw "Telegram API rejected $Method" }
  return $res.result
}

$me = Invoke-Telegram 'getMe'
$commands = @(
  @{ command = 'start'; description = 'Главное меню' },
  @{ command = 'morning'; description = 'Отчёт за сегодня' },
  @{ command = 'cancel'; description = 'Отменить текущее действие' }
)
Invoke-Telegram 'setMyCommands' @{ commands = $commands } | Out-Null
$registered = Invoke-Telegram 'getMyCommands'

[pscustomobject]@{
  bot = '@' + $me.username
  commands = $registered
} | ConvertTo-Json -Depth 4
