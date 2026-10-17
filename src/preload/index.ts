import { contextBridge, ipcRenderer } from 'electron';
import {
  EVENT_CHANNELS,
  REQUEST_CHANNELS,
  type ApiEventMap,
  type EventChannel,
  type IpcResult,
  type RendererApi,
  type RequestChannel,
  type RequestPayload,
  type ResponsePayload
} from '../shared/ipc';

const requestChannels = new Set<string>(REQUEST_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api: RendererApi = {
  invoke<C extends RequestChannel>(
    channel: C,
    payload: RequestPayload<C>
  ): Promise<IpcResult<ResponsePayload<C>>> {
    if (!requestChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'invalid-input', message: `Unknown IPC channel: ${channel}` }
      });
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<ResponsePayload<C>>>;
  },

  on<E extends EventChannel>(event: E, listener: (payload: ApiEventMap[E]) => void): () => void {
    if (!eventChannels.has(event)) return () => undefined;
    const wrapped = (_e: unknown, payload: unknown): void => {
      listener(payload as ApiEventMap[E]);
    };
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
