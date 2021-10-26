import WSService, { WSOptions } from './ws';
declare let Clients: {
  ws: typeof WSService;
};
export declare type ClientOptions = {
  ws: WSOptions;
};
export default Clients;
