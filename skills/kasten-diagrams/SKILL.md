---
name: kasten-diagrams
description: Draw, edit and check diagrams in the KastenFlow vault (architecture, flowcharts, C4, cloud, network, sequence, ER) with the kasten MCP server's typed diagram tools: diagram_new, diagram_describe, diagram_edit, diagram_lint, diagram_preview and diagram_export lay boxes out, keep a person's own edits and need no XML. Use when asked to draw, sketch, diagram or map out a system, a flow, a process or a data model.
---

# Drawing diagrams (catalogue version 1)

Draw with the typed diagram tools, never with draw.io XML or a style of your own. The tools write the XML, place the boxes, and keep what a person drew meanwhile.

## The order of work

1. **Start from a description.** `diagram_new` takes a `spec` (JSON: nodes, groups, edges), a `mermaid` flowchart, or a `template` (c4-context, c4-container, c4-component, three-tier, event-driven, ci-cd, data-pipeline, network, sequence, er). It lays the diagram out and gives it a draft picture. Start from the nearest template when there is one, then change it.
2. **Read before you change.** `diagram_describe` gives every node's id, label, kind and place in page coordinates (x, y, width, height), every edge, the groups, the free room (`free.right`, `free.below`) and the lint findings.
3. **Change with steps.** `diagram_edit` takes a list of steps, run in order on the diagram as it is, so a person's edit made meanwhile is kept. Put a new box beside one that is there with `near` and `side`; wrap boxes in a boundary with `group`; end with `layout` when you added several things. (A layout of a hand-arranged diagram that moves most of its boxes waits for the person's review.)
4. **Check.** `diagram_lint` names what to fix: overlaps, arrows to nothing, crossings, long or missing labels, too many nodes, low contrast, a missing title or legend. Fix errors and warnings, then check again. `diagram_preview` returns a draft picture as SVG text.
5. **Keep a picture.** `diagram_export` with format `svg` keeps the picture in `assets/`; put it in a note with `![](assets/name.svg)`.

`diagram_find_shapes` looks up the editor's own icons by name (`aws4.lambda`, `kubernetes.pod`, `flowchart.decision`); use the key as `shape` in `add_node`. `create_diagram` and `update_diagram` still take whole XML, but use them only to bring in a file you were given. `trash_diagram` always waits for the person.

## Habits that make a diagram good

- One idea per diagram and at most 40 nodes per page. More means a second page (`add_page`) or a group that stands for a part.
- Left to right (`LR`) for flows of data or time; top to bottom (`TB`) for hierarchies, C4, networks and flowcharts.
- Labels are one to four words. Name an arrow for what travels along it (`HTTPS`, `OrderPlaced`, `reads`) unless it is obvious.
- Group what belongs together (a network, a trust zone, a system) and name the group. Do not draw an arrow through a box: move the box or add a group.
- Colour carries meaning: one colour for one kind of thing. Colour with `restyle` and a `token` (blue, green, yellow, orange, red, purple, grey), and leave neutral boxes uncoloured. With three colours or two line styles, add a small `note` as a legend.
- Ids are short, lowercase and stable (`web`, `api`, `orders-db`): the next edit names them.
- Boxes sit on the 10 pixel grid and `layout` puts them there. Do not work out coordinates for more than one or two boxes.
- Labels are plain words, never HTML. A link or an image comes from the catalogue or the vault, not from the web.

## Steps

`diagram_edit{diagram, steps[], page?, preset?, reason?}`; each step is an object with an `op`:

- `add_node{id, label?, kind? | shape?, x?, y?, w?, h?, group?, near?, side?, set?}`: a box. `kind` is from the catalogue below; `shape` is a key of `diagram_find_shapes`; `near` with `side` (`right`, `left`, `above`, `below`) puts it beside another node; `set` adds style words.
- `add_edge{from, to, label?, kind?, id?, waypoints?}`: an arrow. It belongs to the nearest group that holds both ends.
- `update{id, label?, kind?, set?, unset?}`, `move{id, x? y? | dx? dy?, group?}`, `resize{id, w?, h?}`.
- `restyle{ids, token? | kind?, set?, unset?}`, `group{id, label?, members[], kind?, padding?}`, `ungroup{id}`, `delete{ids}` (arrows to a cell, and what a group holds, go with it).
- `set_page{page, name?, width?, height?}`, `add_page{name}`: later steps work on that page.
- `layout{scope?, direction?, spacing?}`: layers, groups and lanes. `scope` is `all` or a group's id, `direction` `LR` or `TB`, `spacing` `compact`, `normal` or `wide`.

Limits: 200 steps and 500 new cells a call, 2,000 cells a diagram. A step that names a cell that is not there fails with its number and nothing is written: read the diagram again and send the rest.

An example, adding a queue between two services:

`diagram_edit{diagram: "Checkout", steps: [{"op": "add_node", "id": "events", "label": "Order events", "kind": "queue", "near": "api", "side": "right"}, {"op": "add_edge", "from": "api", "to": "events", "label": "OrderPlaced", "kind": "async"}, {"op": "restyle", "ids": ["events"], "token": "orange"}, {"op": "layout"}]}`

## Mistakes to avoid

- Guessing a node's place from memory. Read it with `diagram_describe`; a person may have moved it.
- Inventing a kind. One that is not in the catalogue is refused with the list: use `shape` for an icon of the editor, or `set` for a style word.
- Setting `fillColor` or `fontColor` by hand. Use a `token`: the editor's dark mode keeps tokens readable.
- Calling `layout` on a diagram the person arranged by hand when only one box was added. Use `near` instead.
- One huge call. Build the structure, lint it, then add detail.

## The catalogue

A kind is a name for a style and a size. Name a preset with `preset` (in the `spec` of `diagram_new`, or in `diagram_edit`); the default is `architecture-light`. A kind is explained where it is first listed.

### architecture-light - Architecture (light) (default)

services, stores, queues and the calls between them; left to right (`LR`).

- nodes: `service` (a service, app or component), `database` (a database or other store of records), `cache` (a cache or fast store), `queue` (a queue, topic or event bus), `storage` (files or object storage), `actor` (a person or a user), `client` (a browser, app or device that calls in), `gateway` (a gateway, proxy or load balancer), `external` (a system outside the one drawn), `worker` (a job, worker or scheduler), `alert` (something that can fail or needs attention), `cloud` (the internet or a cloud), `note` (a note or a label with no box)
- edges: `sync` (a call that waits for the answer), `async` (a message or event that does not wait), `data` (data flowing one way), `both` (traffic both ways), `depends` (depends on, uses), `line` (a plain line with no arrow)
- groups: `container` (a titled box that holds others), `boundary` (a dashed boundary: a network, a trust zone, a system's edge), `lane` (a swimlane across the diagram)

### network - Network

routers, switches, firewalls and servers; top to bottom (`TB`).

- nodes: `router` (a router), `switch` (a network switch), `firewall` (a firewall), `server` (a server), `cloud`, `client`, `note`
- edges: `line`, `both`, `data`
- groups: `boundary`, `container`

### c4 - C4 model

context, container and component diagrams; top to bottom (`TB`).

- nodes: `person` (C4: a person who uses the system), `external-person` (C4: a person outside the organisation), `system` (C4: a software system you build), `external-system` (C4: a software system someone else runs), `container` (C4: an application or process inside a system), `data-container` (C4: a database or other store inside a system), `component` (C4: a part of a container)
- edges: `rel` (C4: a relationship; label it with what it does)
- groups: `c4-boundary` (C4: a system or container boundary)

### cloud-aws - Cloud: AWS

AWS services as the editor's own icons, in a cloud, region and VPC; left to right (`LR`).

- nodes: `aws-user` (AWS: a user), `aws-client` (AWS: a client), `aws-internet` (AWS: the internet), `aws-function` (AWS Lambda), `aws-compute` (AWS EC2), `aws-container` (AWS ECS), `aws-kubernetes` (AWS EKS), `aws-database` (AWS RDS), `aws-nosql` (AWS DynamoDB), `aws-cache` (AWS ElastiCache), `aws-storage` (AWS S3), `aws-queue` (AWS SQS), `aws-topic` (AWS SNS), `aws-events` (AWS EventBridge), `aws-stream` (AWS Kinesis), `aws-api` (AWS API Gateway), `aws-cdn` (AWS CloudFront), `aws-lb` (AWS load balancer), `aws-dns` (AWS Route 53), `aws-auth` (AWS Cognito), `aws-secrets` (AWS Secrets Manager), `aws-waf` (AWS WAF)
- edges: `sync`, `async`, `data`, `both`
- groups: `aws-cloud` (AWS: the AWS cloud), `aws-region` (AWS: a region), `aws-vpc` (AWS: a virtual private cloud), `boundary`

### cloud-azure - Cloud: Azure

Azure services as the editor's own icons; left to right (`LR`).

- nodes: `az-users` (Azure users), `az-vm` (Azure virtual machine), `az-app` (Azure App Service), `az-function` (Azure Functions), `az-container` (Azure Container Instances), `az-kubernetes` (Azure Kubernetes Service), `az-sql` (Azure SQL Database), `az-cosmos` (Azure Cosmos DB), `az-cache` (Azure Cache for Redis), `az-storage` (Azure Storage account), `az-bus` (Azure Service Bus), `az-events` (Azure Event Hubs), `az-grid` (Azure Event Grid), `az-logic` (Azure Logic Apps), `az-api` (Azure API Management), `az-frontdoor` (Azure Front Door), `az-gateway` (Azure Application Gateway), `az-lb` (Azure load balancer), `az-dns` (Azure DNS), `az-vnet` (Azure virtual network), `az-vault` (Azure Key Vault), `az-monitor` (Azure Monitor)
- edges: `sync`, `async`, `data`, `both`
- groups: `az-boundary` (Azure: a subscription, resource group or virtual network), `boundary`

### cloud-gcp - Cloud: Google Cloud

Google Cloud as boxes in a project and region (the editor draws Google's product icons from pictures, which a typed edit cannot place); left to right (`LR`).

- nodes: `actor`, `client`, `service`, `database`, `cache`, `queue`, `storage`, `gateway`, `worker`, `external`
- edges: `sync`, `async`, `data`, `both`
- groups: `gcp-project` (Google Cloud: a project), `gcp-region` (Google Cloud: a region or zone), `boundary`

### k8s - Kubernetes

pods, services, ingress and volumes in namespaces of a cluster; top to bottom (`TB`).

- nodes: `k8s-user` (Kubernetes user), `k8s-ingress` (Kubernetes ingress), `k8s-svc` (Kubernetes service), `k8s-deploy` (Kubernetes deployment), `k8s-pod` (Kubernetes pod), `k8s-sts` (Kubernetes stateful set), `k8s-job` (Kubernetes job), `k8s-cronjob` (Kubernetes cron job), `k8s-cm` (Kubernetes config map), `k8s-secret` (Kubernetes secret), `k8s-pvc` (Kubernetes persistent volume claim), `k8s-node` (Kubernetes node), `k8s-api` (Kubernetes API server)
- edges: `sync`, `async`, `data`, `depends`
- groups: `k8s-cluster` (Kubernetes: a cluster), `k8s-namespace` (Kubernetes: a namespace)

### flowchart - Flowchart

steps, decisions and where they lead; top to bottom (`TB`).

- nodes: `terminator` (where the flow starts or ends), `process` (a step), `decision` (a yes/no or branching question), `io` (an input or output), `document` (a document or report), `subprocess` (a step that has its own flow), `connector` (a small joining point), `note`
- edges: `flow` (the next step; label the branches of a decision), `async`, `line`
- groups: `container`, `lane`

### sequence - Sequence

who calls whom, in order; lifelines left to right, messages down the page (`LR`).

- nodes: `lifeline` (a participant of a sequence diagram, with the line dropping from it), `actor`, `note`
- edges: `message` (a call from one lifeline to another), `reply` (the answer to a call)

### er - Entity-relationship

tables and how they relate; left to right (`LR`).

- nodes: `field` (one row of an entity: a column and its type), `note`
- edges: `one-to-many` (one row on the left, many on the right), `one-to-one` (one row each side), `many-to-many` (many rows each side)
- groups: `entity` (an entity: a titled box whose children are its fields)

### mind - Mind map

one idea and what branches off it; left to right (`LR`).

- nodes: `idea` (the central idea of a mind map), `branch` (a branch of a mind map), `leaf` (a small point at the end of a branch), `note`
- edges: `branch-line` (a curved line from an idea to its branch)

