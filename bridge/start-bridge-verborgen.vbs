' Start de bridge zonder venster. Wat hij normaal op het scherm zou zetten,
' komt in bridge.log terecht.
'
' Dit script wordt gebruikt door de geplande taak (install-autostart.ps1).
' Handmatig starten kan gewoon met start-bridge.bat.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' 0 = geen venster. True = wachten tot de bridge stopt, zodat de geplande taak
' blijft lopen zolang de bridge draait en niet meteen als "klaar" geldt.
shell.Run "cmd /c start-bridge.bat > bridge.log 2>&1", 0, True
