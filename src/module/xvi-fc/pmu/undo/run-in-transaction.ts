import type { ClientSession, Model } from 'mongoose';

/** Runs `work` in a Mongo transaction on `model`'s connection, always ending the session. */
export async function runInTransaction<T, R>(model: Model<T>, work: (session: ClientSession) => Promise<R>): Promise<R> {
  const session = await model.db.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}
