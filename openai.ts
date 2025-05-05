// workaround for a bun bundler bug -- see ./vendor-openai.sh for more info

import VendoredOpenAI from "./vendored/openai.js";
import type OpenAI from "openai";


const _OpenAI: typeof OpenAI = VendoredOpenAI;
export default _OpenAI;
