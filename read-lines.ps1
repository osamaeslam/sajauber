$file = 'd:/EZZ/osamanew28-main/src/App.tsx'
$start = [int]$args[0]
$end = [int]$args[1]
$content = Get-Content $file
for ($i = $start; $i -le $end; $i++) {
    $line = $content[$i - 1]
    Write-Output ("{0}: {1}" -f $i, $line)
}

