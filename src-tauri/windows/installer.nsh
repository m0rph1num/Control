!macro NSIS_HOOK_PREINSTALL
  ; Control 1.x was an Electron app installed into $PROGRAMFILES64\Control.
  ; Remove it before this installer writes into the same directory.
  IfFileExists "$PROGRAMFILES64\Control\Uninstall Control.exe" 0 legacy_uninstall_done
    ExecWait '"$PROGRAMFILES64\Control\Uninstall Control.exe" /allusers /S'
  legacy_uninstall_done:

  ; The 1.x uninstaller may leave files locked for a moment.
  StrCpy $R5 0
  legacy_wait_loop:
    IfFileExists "$PROGRAMFILES64\Control\resources.pak" 0 legacy_files_done
    IntCmp $R5 20 legacy_force_kill
    Sleep 500
    IntOp $R5 $R5 + 1
    Goto legacy_wait_loop

  legacy_force_kill:
    nsExec::ExecToLog 'taskkill /F /IM "Control.exe"'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "winws.exe"'
    Pop $0
    Sleep 800
    RMDir /r "$PROGRAMFILES64\Control"

  legacy_files_done:

  SetShellVarContext all
  Delete "$SMPROGRAMS\Control.lnk"
  SetShellVarContext current

  ; Drop a leftover 1.x uninstall entry if its uninstaller failed.
  SetRegView 64
  StrCpy $R9 0
  legacy_reg_loop:
    EnumRegKey $R8 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R9
    StrCmp $R8 "" legacy_reg_done
    IntOp $R9 $R9 + 1
    ReadRegStr $R7 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R8" "DisplayName"
    StrCpy $R6 $R7 10
    StrCmp $R6 "Control 1." 0 legacy_reg_loop
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R8"
    Goto legacy_reg_loop
  legacy_reg_done:
  SetRegView 32

  ; Previous 2.x builds are replaced in place by their own uninstaller.
  IfFileExists "$INSTDIR\uninstall.exe" 0 legacy_done
    ExecWait '"$INSTDIR\uninstall.exe" /S _?=$INSTDIR'
    RMDir /r "$INSTDIR"
  legacy_done:
!macroend