import { rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export async function renameWithRetry(source, destination, renameFile = rename, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await wait(200 * (attempt + 1));
    }
  }
}
