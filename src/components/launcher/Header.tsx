import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLauncherStore, type Language } from "@/state";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsDialog } from "./SettingsDialog";
import { ConsoleDialog } from "./ConsoleDialog";
import { AddonsDialog } from "@/components/addons/AddonsDialog";
import { PluginSlot } from "@/components/addons/PluginSlot";

export const Header = () => {
  const { state, updateState } = useLauncherStore();
  const { t } = useTranslation();

  const handleLanguageChange = (val: string | null) => {
    if (val && state) {
      updateState({ ...state, language: val as Language });
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="border-border/50 bg-card/50 flex w-full cursor-default items-center justify-between border-b p-4 backdrop-blur-md select-none"
    >
      <div
        className="pointer-events-none ml-3 flex items-center gap-3"
        data-tauri-drag-region
      >
        <svg
          viewBox="0 0 32.07 73.32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-auto"
        >
          <title>KryoClient</title>
          <path fill="#9EE2FF" d="M16.83 0.40L2.52 18.90L15.77 27.78Z" />
          <path fill="#E9F9FF" d="M16.83 0.40L15.77 27.78L31.67 20.38Z" />
          <path
            fill="#42B7EE"
            d="M2.52 18.90L0.40 48.50L14.18 72.92L15.77 27.78Z"
          />
          <path
            fill="#1C7CD0"
            d="M31.67 20.38L15.77 27.78L14.18 72.92L27.96 52.20Z"
          />
          <path
            fill="#C6ECFF"
            fillOpacity="0.28"
            d="M4.76 24.95L10.90 60.37L11.10 60.31L5.58 24.69Z"
          />
          <path
            fill="#C6ECFF"
            fillOpacity="0.2"
            d="M25.48 30.60L18.86 64.74L19.04 64.82L26.20 30.88Z"
          />
        </svg>
        <h1
          data-tauri-drag-region
          className="text-foreground text-xl font-bold tracking-tight"
        >
          {t("app.title")}
        </h1>
      </div>
      {state && (
        <div className="flex items-center gap-2">
          <PluginSlot name="header.actions" className="mr-1" />
          <AddonsDialog />
          <ConsoleDialog />
          <SettingsDialog />

          <Select value={state.language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue>
                {(val: Language | null) => (
                  <div className="flex items-center gap-2">
                    <Globe className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span>{val === "RUSSIAN" ? "Русский" : "English"}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ENGLISH">English</SelectItem>
              <SelectItem value="RUSSIAN">Русский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </header>
  );
};
