import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { changePasswordAction } from "../../actions";

export const metadata = { title: "Профил" };

export default async function AccountPage() {
  const admin = await requireAdmin();
  return (
    <>
      <PageHeader title="Профил" />
      <Card
        title="Смяна на парола"
        description={`Вход като ${admin.email}. След смяната всички сесии се прекратяват.`}
      >
        <ActionForm action={changePasswordAction} className="flex max-w-sm flex-col gap-4">
          <Field label="Текуща парола" name="current">
            <input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </Field>
          <Field label="Нова парола" name="next" hint="Поне 12 символа.">
            <input
              id="next"
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Повторете новата парола" name="confirm">
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className={inputClass}
            />
          </Field>
          <div>
            <SubmitButton>Смени паролата</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
