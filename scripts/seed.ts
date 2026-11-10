/**
 * Демо данни: 3 бръснаря, 7 услуги, седмичен график, изключение и няколко резервации.
 *
 *   npm run db:seed            # отказва, ако вече има данни
 *   npm run db:seed -- --reset # изтрива каталога/резервациите и сийдва наново
 *
 * НЕ се изпълнява при стартиране на контейнера. Срещу production (NODE_ENV или
 * APP_ENV = production) отказва, освен ако SEED_ALLOW_PRODUCTION=yes.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { addDaysToDateString, isoWeekday, zonedDateString, zonedToUtc } from "../src/server/time";

const TZ = process.env.BUSINESS_TIMEZONE ?? "Europe/Sofia";
const CURRENCY = process.env.CURRENCY ?? "EUR";
const log = (msg: string) => console.log(`[seed] ${msg}`);

function guardProduction() {
  const isProd = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
  if (isProd && process.env.SEED_ALLOW_PRODUCTION !== "yes") {
    log(
      "Отказ: това изглежда като production среда. Задай SEED_ALLOW_PRODUCTION=yes, ако си сигурен.",
    );
    process.exit(1);
  }
}

const SERVICES = [
  {
    name: "Мъжко подстригване",
    description: "Консултация, подстригване с ножица и машинка, измиване и стилизиране.",
    durationMin: 45,
    priceCents: 2500,
  },
  {
    name: "Fade",
    description: "Плавен преход с машинка, оформяне на горната част с ножица.",
    durationMin: 45,
    priceCents: 2800,
  },
  {
    name: "Оформяне на брада",
    description: "Оформяне с машинка и бръснач, гореща кърпа, масло за брада.",
    durationMin: 30,
    priceCents: 1500,
  },
  {
    name: "Подстригване + брада",
    description: "Пълният пакет: коса и брада в едно посещение.",
    durationMin: 75,
    priceCents: 3800,
  },
  {
    name: "Класическо бръснене",
    description: "Бръснене с бръснач, горещи кърпи и балсам.",
    durationMin: 30,
    priceCents: 2000,
  },
  {
    name: "Детско подстригване",
    description: "За момчета до 12 години.",
    durationMin: 30,
    priceCents: 1800,
  },
  {
    name: "Камуфлаж на бели коси",
    description: "Тониране на коса или брада за естествен вид.",
    durationMin: 30,
    priceCents: 2200,
  },
] as const;

const BARBERS = [
  {
    name: "Георги Петров",
    slug: "georgi",
    bio: "Над 10 години опит. Класика, ножица и прецизни линии.",
    services: [0, 1, 2, 3, 4, 6],
  },
  {
    name: "Николай Димитров",
    slug: "nikolay",
    bio: "Fade специалист и любител на модерните форми.",
    services: [0, 1, 3, 5],
  },
  {
    name: "Мартин Стоянов",
    slug: "martin",
    bio: "Майстор на бръснача и брадите.",
    services: [0, 2, 3, 4, 5, 6],
  },
];

// ISO ден → [начало, край, почивка начало, почивка край]
type Day = [string, string, string | null, string | null];
const SCHEDULES: Record<string, Partial<Record<number, Day>>> = {
  georgi: {
    1: ["10:00", "19:00", "13:00", "14:00"],
    2: ["10:00", "19:00", "13:00", "14:00"],
    3: ["10:00", "19:00", "13:00", "14:00"],
    4: ["10:00", "19:00", "13:00", "14:00"],
    5: ["10:00", "19:00", "13:00", "14:00"],
  },
  nikolay: {
    2: ["11:00", "20:00", "15:00", "15:30"],
    3: ["11:00", "20:00", "15:00", "15:30"],
    4: ["11:00", "20:00", "15:00", "15:30"],
    5: ["11:00", "20:00", "15:00", "15:30"],
    6: ["10:00", "16:00", null, null],
  },
  martin: {
    1: ["09:00", "17:00", "12:30", "13:00"],
    3: ["09:00", "17:00", "12:30", "13:00"],
    5: ["09:00", "17:00", "12:30", "13:00"],
    6: ["09:00", "15:00", null, null],
  },
};

const DEMO_CUSTOMERS = [
  { name: "Иван Иванов", phone: "+359888100001" },
  { name: "Петър Колев", phone: "+359888100002" },
  { name: "Стефан Маринов", phone: "+359888100003" },
  { name: "Alex Smith", phone: "+447911123456" },
];

async function main() {
  guardProduction();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("липсва DATABASE_URL");
  const reset = process.argv.includes("--reset");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema });

  try {
    const [existing] = await db.select({ n: count() }).from(schema.barbers);
    if ((existing?.n ?? 0) > 0 && !reset) {
      log(
        "В базата вече има бръснари. Ползвай --reset, за да изтриеш демо данните и да сийднеш наново.",
      );
      return;
    }

    await db.transaction(async (tx) => {
      if (reset) {
        log("изтривам каталога, графиците и резервациите…");
        await tx.execute(
          sql`TRUNCATE ${schema.idempotencyKeys}, ${schema.bookings}, ${schema.scheduleExceptions}, ${schema.workingHours}, ${schema.barberServices}, ${schema.services}, ${schema.barbers} CASCADE`,
        );
      }

      const services = await tx
        .insert(schema.services)
        .values(SERVICES.map((s, i) => ({ ...s, sortOrder: i })))
        .returning();

      const barbers = await tx
        .insert(schema.barbers)
        .values(BARBERS.map((b, i) => ({ name: b.name, slug: b.slug, bio: b.bio, sortOrder: i })))
        .returning();

      for (const [i, b] of BARBERS.entries()) {
        const barber = barbers[i]!;
        await tx
          .insert(schema.barberServices)
          .values(b.services.map((si) => ({ barberId: barber.id, serviceId: services[si]!.id })));
        const days = SCHEDULES[b.slug] ?? {};
        await tx.insert(schema.workingHours).values(
          Object.entries(days).map(([weekday, d]) => ({
            barberId: barber.id,
            weekday: Number(weekday),
            startTime: d![0],
            endTime: d![1],
            breakStart: d![2],
            breakEnd: d![3],
          })),
        );
      }

      // Изключение: Георги е в отпуск след 14 дни; Мартин има скъсен ден след 7 дни.
      const today = zonedDateString(new Date(), TZ);
      await tx.insert(schema.scheduleExceptions).values([
        {
          barberId: barbers[0]!.id,
          date: addDaysToDateString(today, 14),
          type: "off",
          note: "Отпуск",
        },
        {
          barberId: barbers[2]!.id,
          date: addDaysToDateString(today, 7),
          type: "custom",
          startTime: "09:00",
          endTime: "12:00",
          note: "Скъсен ден",
        },
      ]);

      // Няколко бъдещи резервации в работните дни на всеки бръснар.
      let made = 0;
      for (const [bi, b] of BARBERS.entries()) {
        const days = SCHEDULES[b.slug] ?? {};
        const barber = barbers[bi]!;
        let date = addDaysToDateString(today, 2);
        let perBarber = 0;
        for (
          let guard = 0;
          perBarber < 2 && guard < 21;
          guard++, date = addDaysToDateString(date, 1)
        ) {
          const day = days[isoWeekday(date)];
          if (!day) continue;
          const service = services[b.services[perBarber % b.services.length]!]!;
          const customer = DEMO_CUSTOMERS[made % DEMO_CUSTOMERS.length]!;
          const startAt = zonedToUtc(date, day[0], TZ);
          const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);
          await tx.insert(schema.bookings).values({
            barberId: barber.id,
            serviceId: service.id,
            startAt,
            endAt,
            customerName: customer.name,
            customerPhone: customer.phone,
            status: "confirmed",
            source: (["web", "chat", "admin"] as const)[made % 3] ?? "web",
            tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
            serviceName: service.name,
            priceCents: service.priceCents,
            currency: CURRENCY,
            durationMin: service.durationMin,
          });
          made++;
          perBarber++;
        }
      }
      log(`създадени: ${barbers.length} бръснаря, ${services.length} услуги, ${made} резервации`);
    });
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  log(`ГРЕШКА: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
