# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Local models

The demo UI can talk directly to [Ollama](https://ollama.com/). Choose **ollama** as the provider to load available models from `http://127.0.0.1:11434` and chat with them. A small refresh button next to the model drop-down reloads the list.

## Chat suggestions

The "Inputs for inference" section includes a **Suggest** button. It asks the currently selected model to propose sample *needs* and *tech stack* values in JSON and fills the fields automatically. The chat preview also has a **Regen** button to regenerate the last response.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
