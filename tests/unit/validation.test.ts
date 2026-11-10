import { describe, expect, it } from "vitest";
import {
  bookingFormSchema,
  createBookingSchema,
  customerNameSchema,
  dateStringSchema,
  normalizePhone,
} from "@/lib/validation/booking";

describe("normalizePhone", () => {
  it.each([
    ["0888 123 456", "+359888123456"],
    ["0888123456", "+359888123456"],
    ["+359 888 123 456", "+359888123456"],
    ["00359888123456", "+359888123456"],
    ["(02) 981 2345", "+35929812345"],
    ["+44 7911 123456", "+447911123456"],
    ["+49 151 23456789", "+4915123456789"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "123", "abc", "0888 12", "+359 888 123 456 789 000", "0888<script>"])(
    "отхвърля %j",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("customerNameSchema", () => {
  it("приема и нормализира имена", () => {
    expect(customerNameSchema.parse("  Иван   Иванов ")).toBe("Иван Иванов");
    expect(customerNameSchema.parse("Jean-Luc O'Neil")).toBe("Jean-Luc O'Neil");
  });
  it.each(["И", "Ivan123", "http://spam.example", "<b>Иван</b>", "x".repeat(81)])(
    "отхвърля %j",
    (v) => {
      expect(customerNameSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe("dateStringSchema", () => {
  it("валидира реални дати", () => {
    expect(dateStringSchema.safeParse("2026-02-28").success).toBe(true);
    expect(dateStringSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateStringSchema.safeParse("12.11.2026").success).toBe(false);
  });
});

describe("createBookingSchema", () => {
  const valid = {
    serviceId: "8d6f2a4e-1c3b-4b9a-9f0e-2a1b3c4d5e6f",
    barberId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    start: "2026-11-12T10:00:00+02:00",
    customerName: "Иван",
    customerPhone: "0888 123 456",
  };
  it("нормализира телефона", () => {
    expect(createBookingSchema.parse(valid).customerPhone).toBe("+359888123456");
  });
  it("изисква часова зона в start", () => {
    expect(createBookingSchema.safeParse({ ...valid, start: "2026-11-12T10:00:00" }).success).toBe(
      false,
    );
  });
  it("формата изисква съгласие и празен honeypot", () => {
    expect(bookingFormSchema.safeParse({ ...valid, consent: true }).success).toBe(true);
    expect(bookingFormSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, consent: true, website: "spam" }).success).toBe(
      false,
    );
  });
});
