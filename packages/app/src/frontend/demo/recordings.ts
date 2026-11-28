/**
 * Recorded REAL AI drafts (see scripts/record-drafts.ts). Replayed in the
 * hosted demo and labelled "recorded" in the UI. Responses are unedited.
 */
import cbc1 from "./recordings/cbc-attempt1.json";
import bmp1 from "./recordings/bmp-attempt1.json";
import lipid1 from "./recordings/lipid-attempt1.json";

export interface DraftRecording {
  layoutId: string;
  attempt: number;
  capturedAt: string;
  aiModel: string;
  via: string;
  promptVersion: string;
  promptHash: string;
  prompt: string;
  responseText: string;
}

export const RECORDINGS: Record<"cbc" | "bmp" | "lipid", DraftRecording> = {
  cbc: cbc1,
  bmp: bmp1,
  lipid: lipid1,
};
