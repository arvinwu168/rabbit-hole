import type { Metadata } from "next";
import { Rabbit } from "lucide-react";
import { AccessLoginForm } from "@/components/access-login-form";

export const metadata: Metadata = {
  title: "Private demo — Rabbit Hole",
  description: "Enter the shared password to open the Rabbit Hole demo.",
};

export default function LoginPage() {
  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-mark" aria-hidden="true">
          <Rabbit size={26} strokeWidth={1.8} />
        </div>
        <p className="access-eyebrow">Private demo</p>
        <h1 id="access-title">Enter the rabbit hole</h1>
        <p className="access-copy">
          This preview is password protected to keep model usage private.
        </p>
        <AccessLoginForm />
      </section>
    </main>
  );
}
