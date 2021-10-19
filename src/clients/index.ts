import WSService, { WSOptions } from './ws';

let Clients = {
  ws: WSService
};

export type ClientOptions = {
  ws: WSOptions;
};
export default Clients;
