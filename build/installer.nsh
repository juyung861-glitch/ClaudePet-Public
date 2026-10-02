; ClaudePet installer extras
; On uninstall (not on update), remove only ClaudePet hooks and the /pet command from Claude Code settings.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\ClaudePet.exe" --remove-hooks'
  ${endIf}
!macroend
