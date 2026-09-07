' Start de bridge zonder venster. Wat hij normaal op het scherm zou zetten,
' komt in het logbestand terecht.
'
' Dat logbestand staat bewust buiten de projectmap: die staat vaak in OneDrive,
' en een bestand dat continu herschreven wordt synchroniseert niet betrouwbaar.
' Je leest dan oude regels terwijl je denkt naar de laatste start te kijken.
'
' Dit script wordt gebruikt door de geplande taak (install-autostart.ps1).
' Handmatig starten kan gewoon met start-bridge.bat.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

logMap = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\projectdoc-bridge"
If Not fso.FolderExists(logMap) Then fso.CreateFolder(logMap)

' 0 = geen venster. True = wachten tot de bridge stopt, zodat de geplande taak
' blijft lopen zolang de bridge draait en niet meteen als "klaar" geldt.
shell.Run "cmd /c start-bridge.bat > """ & logMap & "\bridge.log"" 2>&1", 0, True
