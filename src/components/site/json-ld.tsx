import { site } from "@/config/site";
import type { ServiceWithBarbers } from "@/server/booking";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** schema.org HairSalon (подтип на LocalBusiness) за търсачките. */
export function LocalBusinessJsonLd({
  baseUrl,
  services,
  hours,
  currency,
}: {
  baseUrl: string;
  services: ServiceWithBarbers[];
  hours: ({ open: string; close: string } | null)[];
  currency: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    "@id": `${baseUrl}#business`,
    name: site.name,
    description: site.description,
    url: baseUrl,
    telephone: site.contact.phoneHref,
    email: site.contact.email,
    priceRange: site.priceRange,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      postalCode: site.address.postalCode,
      addressRegion: site.address.region,
      addressCountry: site.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: site.address.geo.lat,
      longitude: site.address.geo.lng,
    },
    openingHoursSpecification: hours.flatMap((h, i) =>
      h
        ? [
            {
              "@type": "OpeningHoursSpecification",
              dayOfWeek: `https://schema.org/${DAYS[i]}`,
              opens: h.open,
              closes: h.close,
            },
          ]
        : [],
    ),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Услуги",
      itemListElement: services.map((s) => ({
        "@type": "Offer",
        price: (s.priceCents / 100).toFixed(2),
        priceCurrency: currency,
        itemOffered: { "@type": "Service", name: s.name, description: s.description || undefined },
      })),
    },
    sameAs: [site.social.instagram, site.social.facebook].filter(Boolean),
    potentialAction: {
      "@type": "ReserveAction",
      target: { "@type": "EntryPoint", urlTemplate: `${baseUrl}/book` },
    },
  };
  // `<` се екранира, за да не може съдържание от БД да затвори <script> тага.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
