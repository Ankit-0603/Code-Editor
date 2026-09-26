export interface User {
  id: string;
  // Prisma returns null for optional fields, so the types say so here.
  // OAuth providers don't always give a name or a picture.
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  title: string;
  description: string | null;
  template: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  user: User;
  Starmark: { isMarked: boolean }[];
}