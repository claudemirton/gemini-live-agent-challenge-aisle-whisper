export interface AppSettings {
  pushToTalk: boolean;
  language: string;
  frameRate: string;
  detailLevel: string;
  streamModel: string;
  deepChecks: string;
  thinkingLevel: string;
}

export const SETTINGS_STORAGE_KEY = "aisle-whisper/settings";

export const DEFAULT_SETTINGS: AppSettings = {
  pushToTalk: true,
  language: "en",
  frameRate: "auto",
  detailLevel: "auto",
  streamModel: "flash",
  deepChecks: "pro",
  thinkingLevel: "low",
};

export function loadSettingsFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      pushToTalk:
        typeof parsed.pushToTalk === "boolean"
          ? parsed.pushToTalk
          : DEFAULT_SETTINGS.pushToTalk,
      language:
        typeof parsed.language === "string"
          ? parsed.language
          : DEFAULT_SETTINGS.language,
      frameRate:
        typeof parsed.frameRate === "string"
          ? parsed.frameRate
          : DEFAULT_SETTINGS.frameRate,
      detailLevel:
        typeof parsed.detailLevel === "string"
          ? parsed.detailLevel
          : DEFAULT_SETTINGS.detailLevel,
      streamModel:
        typeof parsed.streamModel === "string"
          ? parsed.streamModel
          : DEFAULT_SETTINGS.streamModel,
      deepChecks:
        typeof parsed.deepChecks === "string"
          ? parsed.deepChecks
          : DEFAULT_SETTINGS.deepChecks,
      thinkingLevel:
        typeof parsed.thinkingLevel === "string"
          ? parsed.thinkingLevel
          : DEFAULT_SETTINGS.thinkingLevel,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsToStorage(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function frameRateToIntervalMs(frameRate: string): number {
  if (frameRate === "2fps") {
    return 500;
  }
  if (frameRate === "5fps") {
    return 200;
  }
  return 1000;
}
