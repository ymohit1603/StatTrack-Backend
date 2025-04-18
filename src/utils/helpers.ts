import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateUsername(displayName: string): Promise<string> {
  // Remove special characters and spaces, convert to lowercase
  let baseUsername = displayName
    .toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, '');

  let username = baseUsername;
  let counter = 1;

  // Keep trying until we find a unique username
  while (true) {
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (!existingUser) {
      return username;
    }

    // If username exists, append a number and try again
    username = `${baseUsername}${counter}`;
    counter++;
  }
} 