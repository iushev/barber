import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Field, inputClass } from "@/components/admin/ui";
import { getCurrentAdmin } from "@/server/auth/session";
import { loginAction } from "../actions";

export const metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentAdmin()) redirect("/admin/bookings");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-semibold">Вход за администратор</h1>
      <ActionForm action={loginAction} className="flex flex-col gap-4">
        <Field label="Имейл" name="email">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
          />
        </Field>
        <Field label="Парола" name="password">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </Field>
        <SubmitButton>Вход</SubmitButton>
      </ActionForm>
    </main>
  );
}
