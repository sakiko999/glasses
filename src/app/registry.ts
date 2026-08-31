import type { AppModule, AppManifest } from './types';

export class AppRegistry {
  private readonly modules = new Map<string, AppModule>();

  register(module: AppModule): void {
    if (this.modules.has(module.manifest.id)) {
      throw new Error(`应用已注册: ${module.manifest.id}`);
    }
    this.modules.set(module.manifest.id, module);
  }

  unregister(id: string): void {
    this.modules.delete(id);
  }

  get(id: string): AppModule | undefined {
    return this.modules.get(id);
  }

  list(): AppManifest[] {
    return [...this.modules.values()].map((m) => m.manifest);
  }
}
