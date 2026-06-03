import { PlaceholderProvider } from "./placeholderProvider.js";

export function createGeminiPlaceholder(): PlaceholderProvider {
  return new PlaceholderProvider("gemini", "Gemini native adapter", "gemini-2.5-pro", "Google Gemini API support is planned but not implemented in this build.");
}
