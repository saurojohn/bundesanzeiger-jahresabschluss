-- AlterTable
ALTER TABLE "wp_pruefungs_abschluss" ADD COLUMN     "freigegebenAm" TIMESTAMP(3),
ADD COLUMN     "freigegebenVonId" UUID;

-- AddForeignKey
ALTER TABLE "wp_pruefungs_abschluss" ADD CONSTRAINT "wp_pruefungs_abschluss_freigegebenVonId_fkey" FOREIGN KEY ("freigegebenVonId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
