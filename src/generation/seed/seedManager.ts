import { PRNG } from '../math/prng.ts';

export type SeedChangeListener = (seed: string, numericSeed: number) => void;

export class SeedManager {
  private static instance: SeedManager;
  private currentSeedString: string = 'Avalon';
  private currentNumericSeed: number = 0;
  private listeners: SeedChangeListener[] = [];

  private constructor() {
    this.setSeed('Avalon');
  }

  public static getInstance(): SeedManager {
    if (!SeedManager.instance) {
      SeedManager.instance = new SeedManager();
    }
    return SeedManager.instance;
  }

  public setSeed(seed: string): void {
    this.currentSeedString = seed.trim() || 'Avalon';
    this.currentNumericSeed = PRNG.hashString(this.currentSeedString);
    this.notifyListeners();
  }

  public randomizeSeed(): string {
    const adjectives = ['Silent', 'Verdant', 'Emerald', 'Misty', 'Ancient', 'Solitary', 'Crystal', 'Windswept', 'Sunlit', 'Wild'];
    const nouns = ['Archipelago', 'Isle', 'Haven', 'Reach', 'Coast', 'Valley', 'Ridge', 'Cove', 'Shores', 'Sanctuary'];
    const num = Math.floor(Math.random() * 900 + 100);
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const newSeed = `${adj}-${noun}-${num}`;
    this.setSeed(newSeed);
    return newSeed;
  }

  public getSeedString(): string {
    return this.currentSeedString;
  }

  public getNumericSeed(): number {
    return this.currentNumericSeed;
  }

  public subscribe(listener: SeedChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentSeedString, this.currentNumericSeed);
    }
  }
}
