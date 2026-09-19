!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\.kryoclient"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
