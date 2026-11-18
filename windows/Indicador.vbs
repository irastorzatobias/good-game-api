' Abre el indicador de la bandeja (indicador.ps1) sin mostrar ninguna ventana.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & carpeta & "\indicador.ps1""", 0, False
