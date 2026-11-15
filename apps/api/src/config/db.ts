import mongoose from 'mongoose';

export async function connectDb(uri: string, dbName: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  return mongoose;
}

export async function pingDb(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) return false;
  try {
    await db.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
