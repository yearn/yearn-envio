// Config interpolation requires RPC URLs even when all events are simulated.
process.env.ENVIO_RPC_URL_HYPEREVM ??= "http://127.0.0.1:8545";
process.env.ENVIO_RPC_URL_ROBINHOOD ??= "http://127.0.0.1:8545";
