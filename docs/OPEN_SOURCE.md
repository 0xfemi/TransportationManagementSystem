# Open-source strategy

## Licence: Apache 2.0

The goals are self-hosting, contributions, extensions, integrations and commercial use.

| Licence | For | Against, given those goals |
|---|---|---|
| **MIT** | Shortest and best known; maximum freedom. | No patent grant. Logistics optimization is a patent-heavy field, and contributors and users get no protection. |
| **Apache 2.0** | Permissive like MIT, plus an explicit patent licence from every contributor and termination of that licence for anyone who sues over the code. Widely accepted by corporate legal teams, which matters for enterprise integration. | Anyone can build a closed, hosted product on it and contribute nothing back. |
| **AGPLv3** | Closes the hosted-service loophole: run a modified version as a service and you must publish your changes. | Many companies forbid AGPL software outright. That would shut out the 3PLs and enterprises the project wants as users and integrators, and discourages embedding it in commercial products. |

**Choice: Apache 2.0.** Adoption and integration matter more to this project at this stage than preventing closed forks, and the patent grant is worth more than MIT's brevity. The accepted cost is that a company can host a closed derivative.

This was chosen while setting up the project and is the maintainer's to change. Changing it later is easy while there is a single copyright holder and hard once there are outside contributors.

## Governance

Single maintainer for now. Decisions with lasting consequences are recorded as architecture decision records in [docs/adr](adr/). If the project gains regular contributors, the next steps are a `MAINTAINERS` file and a written decision process.

## How the project stays easy to contribute to

- One command to run it, one to test it.
- Domain logic in plain functions with tests.
- Issue and pull-request templates that ask for the information a reviewer needs.
- A roadmap ([PRODUCT.md](PRODUCT.md#roadmap)) so contributors can see what is wanted.

## Extension points

Present today: the `RoutingProvider` interface, the map tile configuration, the REST API and event log.

Planned: a plugin interface so routing engines, carrier integrations, telematics feeds, notification channels and AI providers can be added without changing core modules. Integrations will be adapters at the edge and will not be written into the domain model.

## Clean-room commitment

Contributions must be the contributor's own work or compatibly licensed. Do not contribute code, schemas, screens, documentation or terminology taken from proprietary transportation management products, including from memory of working with them.
