import type { Metadata } from "next";
import { env } from "@/config/env";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Политика за поверителност",
  alternates: { canonical: "/privacy" },
};

// TODO: замени — текстът е шаблон; прегледайте го с юрист преди пускане.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const { legal, contact, address } = site;
  const retentionMonths = env().DATA_RETENTION_MONTHS;
  return (
    <article className="[&_h2]:font-display mx-auto max-w-3xl px-4 py-12 sm:py-16 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:tracking-wide [&_h2]:uppercase [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
      <h1 className="font-display text-4xl tracking-wide uppercase">Политика за поверителност</h1>
      <p className="text-bone/60">
        Тук обясняваме какви лични данни събираме при онлайн записване, защо и колко дълго ги пазим.
      </p>

      <h2>Администратор на данните</h2>
      <p>
        {legal.controller}, ЕИК {legal.eik}, {address.street}, {address.postalCode} {address.city}.
        Контакт:{" "}
        <a href={`mailto:${contact.email}`} className="text-brass underline underline-offset-4">
          {contact.email}
        </a>
        , {contact.phone}.
      </p>

      <h2>Какви данни събираме</h2>
      <ul>
        <li>
          Име и телефонен номер, които въвеждате при записване (през формата или чат асистента).
        </li>
        <li>Детайли за резервацията: услуга, бръснар, дата и час.</li>
        <li>
          При използване на чат асистента — съдържанието на разговора, необходимо за записването.
          Съобщенията се обработват от OpenAI като подизпълнител.
        </li>
      </ul>
      <p>
        Не изискваме регистрация, имейл или други лични данни. Не използваме рекламни бисквитки.
      </p>

      <h2>Защо ги обработваме</h2>
      <p>
        Единствено за да запазим, изпълним и при нужда променим часа ви (включително да ви се
        обадим, ако бръснарят е възпрепятстван). Основание: вашето съгласие и предприемане на стъпки
        преди сключване на договор (чл. 6, ал. 1, б. „а“ и „б“ от GDPR).
      </p>

      <h2>Колко дълго ги пазим</h2>
      <p>
        До {retentionMonths} месеца след датата на посещението, след което данните се анонимизират.
        Историята на чат разговорите се пази за кратко и се изтрива при анонимизиране.
      </p>

      <h2>Бисквитки</h2>
      <p>
        Използваме само технически необходими бисквитки: за сесията на чат асистента (случаен
        идентификатор, без лични данни) и за вход в администраторския панел.
      </p>

      <h2>Вашите права</h2>
      <p>
        Можете да поискате достъп, корекция или изтриване на данните си, както и да оттеглите
        съгласието си, като се свържете с нас на посочените контакти. Имате право на жалба до
        Комисията за защита на личните данни (www.cpdp.bg).
      </p>
    </article>
  );
}
