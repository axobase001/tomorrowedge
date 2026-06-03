import React, { useMemo, useState } from "react";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const canSubmit = useMemo(() => email.includes("@") && password.length >= 8, [email, password]);

  return (
    <main className="screen">
      <section className="panel">
        <h1>TomorrowEdge</h1>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button disabled={!canSubmit}>Sign in</button>
      </section>
    </main>
  );
}
