import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class LocalJsonTaskStore {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory;
    this.scope = 'LOCAL_TEST_ONLY';
  }

  async save(task) {
    if (!task?.taskId) throw new Error('taskId is required.');
    await mkdir(this.rootDirectory, { recursive: true });
    const destination = path.join(this.rootDirectory, `${task.taskId}.json`);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...task, persistenceScope: this.scope }, null, 2), 'utf8');
    await rename(temporary, destination);
    return destination;
  }

  async load(taskId) {
    const text = await readFile(path.join(this.rootDirectory, `${taskId}.json`), 'utf8');
    return JSON.parse(text);
  }
}
