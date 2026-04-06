import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed default config
  await prisma.config.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, data: {} },
  });
  console.log("Database seeded successfully");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
