-- Create the AppName enum type
CREATE TYPE "AppName" AS ENUM ('X', 'LinkedIn');

-- Convert existing app_name values
UPDATE "User"
SET app_name = 'X'
WHERE app_name = 'CodeTime' AND "twitterId" IS NOT NULL;

UPDATE "User"
SET app_name = 'LinkedIn'
WHERE app_name = 'CodeTime' AND "linkedinId" IS NOT NULL;

-- Alter the app_name column to use the enum
ALTER TABLE "User" 
ALTER COLUMN app_name TYPE "AppName" 
USING app_name::text::"AppName",
ALTER COLUMN app_name SET DEFAULT 'X'; 