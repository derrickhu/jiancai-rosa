import { SAVE_KEY } from '@/config/CloudConfig';
import { PersistService } from '@/core/PersistService';
import { decayFridge, normalizeSave, regenStamina, type KitchenSave } from '@/sim/kitchen';

class SaveManagerClass {
  data: KitchenSave = normalizeSave(null);

  load(): KitchenSave {
    const raw = PersistService.readJSON<KitchenSave>(SAVE_KEY);
    const now = Date.now();
    let data = normalizeSave(raw && raw.version === 1 ? raw : null, now);
    data = regenStamina(data, now);
    data = decayFridge(data, now);
    this.data = data;
    this.flush();
    return this.data;
  }

  replace(next: KitchenSave): void {
    this.data = next;
    this.flush();
  }

  flush(): void {
    PersistService.writeJSON(SAVE_KEY, this.data);
  }
}

export const SaveManager = new SaveManagerClass();
