import produce, { Draft } from 'immer';
import create, { State, StateCreator } from 'zustand';
import type { ServeConfig } from '../../types';

const immer =
  <T extends State>(
    config: StateCreator<T, (fn: (draft: Draft<T>) => void) => void>
  ): StateCreator<T> =>
  (set, get, api) =>
    config((fn) => set(produce<T>(fn)), get, api);

interface ValidationError {
  path: string;
  errors: string[];
  message: string;
  type: string;
}

type ServeStatusStoreState = {
  state: ServeConfig;
  selectedAddress: string | undefined;
  errors: ValidationError[];
  isLoaded: boolean;
  showAdvanced: boolean;
  update: (fn: (draft: Draft<ServeStatusStoreState>) => void) => void;
  setErrors: (errors: ValidationError[]) => void;
};

export const useServeStatusStore = create<ServeStatusStoreState>(
  immer((set) => ({
    errors: [],
    state: {},
    isLoaded: false,
    selectedAddress: undefined,
    showAdvanced: false,
    update: (fn) => {
      set(fn);
    },
    setErrors: (errors) => {
      set((draft) => {
        draft.errors = errors;
      });
    },
  }))
);
