import { STORAGE_KEY } from "../shared/constants";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<void> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] ?? {}) };

  ($<HTMLInputElement>("enabled")).checked = settings.enabled;
  ($<HTMLInputElement>("fontSize")).value = String(settings.fontSize || 12);
  ($<HTMLInputElement>("barHeight")).value = String(settings.barHeight || 34);
  ($<HTMLInputElement>("maxRows")).value = String(settings.maxRows);
  ($<HTMLSelectElement>("displayMode")).value = settings.displayMode;
  ($<HTMLSelectElement>("folderOpenMode")).value = settings.folderOpenMode;
  ($<HTMLSelectElement>("showCondition")).value = settings.showCondition;
}

async function save(): Promise<void> {
  const settings: Settings = {
    enabled: ($<HTMLInputElement>("enabled")).checked,
    fontSize: parseInt(($<HTMLInputElement>("fontSize")).value, 10) || 12,
    barHeight: parseInt(($<HTMLInputElement>("barHeight")).value, 10) || 34,
    maxRows: parseInt(($<HTMLInputElement>("maxRows")).value, 10) || 0,
    displayMode: ($<HTMLSelectElement>("displayMode")).value as Settings["displayMode"],
    folderOpenMode: ($<HTMLSelectElement>("folderOpenMode")).value as Settings["folderOpenMode"],
    showCondition: ($<HTMLSelectElement>("showCondition")).value as Settings["showCondition"],
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

document.addEventListener("DOMContentLoaded", async () => {
  await load();

  const inputs = document.querySelectorAll("input, select");
  inputs.forEach((el) => {
    el.addEventListener("change", save);
    el.addEventListener("input", save);
  });
});
