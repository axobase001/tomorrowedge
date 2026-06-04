const promptInput = document.querySelector("#prompt");
const temperatureInput = document.querySelector("#temperature");
const temperatureValue = document.querySelector("#temperatureValue");
const maxTokensInput = document.querySelector("#maxTokens");
const button = document.querySelector("#generate");
const output = document.querySelector("#output");
const modelInfo = document.querySelector("#modelInfo");

temperatureInput.addEventListener("input", () => {
  temperatureValue.textContent = temperatureInput.value;
});

button.addEventListener("click", async () => {
  button.disabled = true;
  output.textContent = "Generating...";
  try {
    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptInput.value,
        temperature: Number(temperatureInput.value),
        maxTokens: Number(maxTokensInput.value)
      })
    });
    const payload = await response.json();
    output.textContent = payload.text ?? JSON.stringify(payload, null, 2);
    modelInfo.textContent = `${payload.modelInfo.type}, ${payload.modelInfo.parameterCount} tiny transition parameters, no cloud API`;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});

fetch("/model-info")
  .then((response) => response.json())
  .then((info) => {
    modelInfo.textContent = `${info.type}, ${info.parameterCount} tiny transition parameters, no cloud API`;
  })
  .catch(() => {});
