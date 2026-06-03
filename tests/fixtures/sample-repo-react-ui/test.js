import { readFileSync } from "node:fs";

const source = readFileSync("src/LoginPage.jsx", "utf8");

if (!source.includes("disabled={!canSubmit}")) {
  throw new Error("login button must stay disabled until the form is valid");
}

if (!source.includes("password.length >= 8")) {
  throw new Error("password validation must be explicit");
}

console.log("ok");
