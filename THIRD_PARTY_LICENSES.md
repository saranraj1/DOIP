# Third-Party Licenses

**Standing rule (Master Doc Ch. 19 §19.6):** every dependency must be (a) free, (b) Apache-2.0-compatible or explicitly noted otherwise, and (c) recorded here **before** it is merged. CI fails if a dependency in the lockfiles is missing from this table.

| Component                  | License                         | Use                           | Notes                                                                                         |
| -------------------------- | ------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| PostgreSQL + PostGIS       | PostgreSQL / GPL-2.0 (PostGIS)  | Primary datastore, geospatial | Server-side use only; no distribution concern                                                 |
| Redis                      | RSALv2/SSPL (or Valkey BSD-3)   | Pub/sub, cache                | Prefer Valkey if redistribution ever matters                                                  |
| FastAPI, Uvicorn, Pydantic | MIT                             | API layer                     |                                                                                               |
| React, Vite                | MIT                             | Frontend                      |                                                                                               |
| Leaflet                    | BSD-2                           | Map rendering                 |                                                                                               |
| OpenStreetMap tiles/data   | ODbL                            | Base map                      | **Attribution mandatory:** “© OpenStreetMap contributors” visible on every map view           |
| Ollama                     | MIT                             | Local LLM runtime             |                                                                                               |
| Llama 3                    | Meta Llama 3 Community License  | Sitreps, Q&A                  | Acceptable-use policy applies; not Apache-compatible — noted exception                        |
| Qwen                       | Apache-2.0                      | Alternative LLM               |                                                                                               |
| YOLO (Ultralytics)         | **AGPL-3.0**                    | Vision detection              | Isolated in its own service; if AGPL is unacceptable, swap to YOLO-NAS / RT-DETR (Apache-2.0) |
| ChromaDB / pgvector        | Apache-2.0 / PostgreSQL         | Vector store for RAG          |                                                                                               |
| Prometheus, Grafana        | Apache-2.0 / AGPL-3.0 (Grafana) | Monitoring                    | Grafana used unmodified, server-side — noted exception                                        |
| ffmpeg                     | LGPL/GPL components             | Footage processing            | Build-time tool only, not linked                                                              |
| VisDrone dataset           | Academic/research use only      | CV fine-tuning demos ONLY     | **Never** in the default demo path; synthetic frames are the default                          |
| Pexels / Pixabay clips     | Pexels/Pixabay License          | Optional footage              | Free use; no attribution required, recorded per-clip in `footage/manifest.yaml`               |
| PyYAML                     | MIT                             | Scenario DSL parsing          | Standard YAML parser for scenario corpus                                                      |
| pytest                     | MIT                             | Automated testing             | Test runner for golden-run determinism and DSL verification                                   |

## How to add a dependency

1. Check the license is free + compatible (or justify an exception in the Notes column).
2. Add the row here in the same PR that adds the dependency.
3. CI (`license-check` job) must pass.
