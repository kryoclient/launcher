!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Also remove everything KRYO downloaded?$\r$\n$\r$\nThis deletes $APPDATA\.kryo (Minecraft versions, libraries, assets, Java runtimes and your worlds) and the launcher's own settings and accounts.$\r$\n$\r$\nChoose No to keep them for a later reinstall. A game folder you moved yourself is never touched." /SD IDNO IDYES kryoWipeData IDNO kryoKeepData
    kryoWipeData:
      RMDir /r "$APPDATA\.kryo"
      RMDir /r "$APPDATA\KRYO Client"
    kryoKeepData:
  ${endIf}
!macroend
