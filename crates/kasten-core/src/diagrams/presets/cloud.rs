//! Cloud and cluster kinds. Each node kind names a shape of the generated
//! shape index, so the style is the editor's own and nothing is pasted by
//! hand. Google's product icons are cards of embedded pictures in the
//! editor, not shapes, so that preset draws plain boxes in a project and
//! region of its own.

use super::{GroupKind, NodeKind, Preset};

macro_rules! icon {
    ($name:expr, $about:expr, $shape:expr) => {
        NodeKind {
            name: $name,
            about: $about,
            style: "",
            w: 78.0,
            h: 78.0,
            shape: Some($shape),
            c4: None,
        }
    };
}

pub(super) const NODES: &[NodeKind] = &[
    icon!("aws-user", "AWS: a user", "aws4.user"),
    icon!("aws-client", "AWS: a client", "aws4.client"),
    icon!("aws-internet", "AWS: the internet", "aws4.internet"),
    icon!("aws-function", "AWS Lambda", "aws4.lambda"),
    icon!("aws-compute", "AWS EC2", "aws4.ec2"),
    icon!("aws-container", "AWS ECS", "aws4.ecs"),
    icon!("aws-kubernetes", "AWS EKS", "aws4.eks"),
    icon!("aws-database", "AWS RDS", "aws4.rds"),
    icon!("aws-nosql", "AWS DynamoDB", "aws4.dynamodb"),
    icon!("aws-cache", "AWS ElastiCache", "aws4.elasticache"),
    icon!("aws-storage", "AWS S3", "aws4.s3"),
    icon!("aws-queue", "AWS SQS", "aws4.sqs"),
    icon!("aws-topic", "AWS SNS", "aws4.sns"),
    icon!("aws-events", "AWS EventBridge", "aws4.eventbridge"),
    icon!("aws-stream", "AWS Kinesis", "aws4.kinesis"),
    icon!("aws-api", "AWS API Gateway", "aws4.api_gateway"),
    icon!("aws-cdn", "AWS CloudFront", "aws4.cloudfront"),
    icon!(
        "aws-lb",
        "AWS load balancer",
        "aws4.application_load_balancer"
    ),
    icon!("aws-dns", "AWS Route 53", "aws4.route_53"),
    icon!("aws-auth", "AWS Cognito", "aws4.cognito"),
    icon!("aws-secrets", "AWS Secrets Manager", "aws4.secrets_manager"),
    icon!("aws-waf", "AWS WAF", "aws4.waf"),
    icon!(
        "az-vm",
        "Azure virtual machine",
        "azure2.compute_virtual_machine"
    ),
    icon!("az-app", "Azure App Service", "azure2.compute_app_services"),
    icon!(
        "az-function",
        "Azure Functions",
        "azure2.compute_function_apps"
    ),
    icon!(
        "az-container",
        "Azure Container Instances",
        "azure2.compute_container_instances"
    ),
    icon!(
        "az-kubernetes",
        "Azure Kubernetes Service",
        "azure2.compute_kubernetes_services"
    ),
    icon!(
        "az-sql",
        "Azure SQL Database",
        "azure2.databases_sql_database"
    ),
    icon!(
        "az-cosmos",
        "Azure Cosmos DB",
        "azure2.databases_azure_cosmos_db"
    ),
    icon!(
        "az-cache",
        "Azure Cache for Redis",
        "azure2.databases_cache_redis"
    ),
    icon!(
        "az-storage",
        "Azure Storage account",
        "azure2.storage_storage_accounts"
    ),
    icon!(
        "az-bus",
        "Azure Service Bus",
        "azure2.integration_service_bus"
    ),
    icon!(
        "az-events",
        "Azure Event Hubs",
        "azure2.analytics_event_hubs"
    ),
    icon!(
        "az-grid",
        "Azure Event Grid",
        "azure2.integration_event_grid_topics"
    ),
    icon!(
        "az-logic",
        "Azure Logic Apps",
        "azure2.integration_logic_apps"
    ),
    icon!(
        "az-api",
        "Azure API Management",
        "azure2.integration_api_management_services"
    ),
    icon!(
        "az-frontdoor",
        "Azure Front Door",
        "azure2.networking_front_doors"
    ),
    icon!(
        "az-gateway",
        "Azure Application Gateway",
        "azure2.networking_application_gateways"
    ),
    icon!(
        "az-lb",
        "Azure load balancer",
        "azure2.networking_load_balancers"
    ),
    icon!("az-dns", "Azure DNS", "azure2.networking_dns_zones"),
    icon!(
        "az-vnet",
        "Azure virtual network",
        "azure2.networking_virtual_networks"
    ),
    icon!("az-vault", "Azure Key Vault", "azure2.security_key_vaults"),
    icon!(
        "az-monitor",
        "Azure Monitor",
        "azure2.management_governance_monitor"
    ),
    icon!("az-users", "Azure users", "azure2.identity_users"),
    icon!("k8s-pod", "Kubernetes pod", "kubernetes.pod"),
    icon!("k8s-deploy", "Kubernetes deployment", "kubernetes.deploy"),
    icon!("k8s-sts", "Kubernetes stateful set", "kubernetes.sts"),
    icon!("k8s-job", "Kubernetes job", "kubernetes.job"),
    icon!("k8s-cronjob", "Kubernetes cron job", "kubernetes.cronjob"),
    icon!("k8s-svc", "Kubernetes service", "kubernetes.svc"),
    icon!("k8s-ingress", "Kubernetes ingress", "kubernetes.ing"),
    icon!("k8s-cm", "Kubernetes config map", "kubernetes.cm"),
    icon!("k8s-secret", "Kubernetes secret", "kubernetes.secret"),
    icon!(
        "k8s-pvc",
        "Kubernetes persistent volume claim",
        "kubernetes.pvc"
    ),
    icon!("k8s-node", "Kubernetes node", "kubernetes.node"),
    icon!("k8s-api", "Kubernetes API server", "kubernetes.api"),
    icon!("k8s-user", "Kubernetes user", "kubernetes.user"),
];

macro_rules! group {
    ($name:expr, $about:expr, $style:expr) => {
        GroupKind {
            name: $name,
            about: $about,
            style: $style,
            stack: false,
        }
    };
}

pub(super) const GROUPS: &[GroupKind] = &[
    group!(
        "aws-cloud",
        "AWS: the AWS cloud",
        "outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;"
    ),
    group!(
        "aws-region",
        "AWS: a region",
        "fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontStyle=0;fontColor=#147EBA;whiteSpace=wrap;html=1;container=1;collapsible=0;align=left;spacingLeft=10;"
    ),
    group!(
        "aws-vpc",
        "AWS: a virtual private cloud",
        "fillColor=none;strokeColor=#248814;dashed=0;verticalAlign=top;fontStyle=0;fontColor=#248814;whiteSpace=wrap;html=1;container=1;collapsible=0;align=left;spacingLeft=10;"
    ),
    group!(
        "az-boundary",
        "Azure: a subscription, resource group or virtual network",
        "rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#0078D4;fontColor=#0078D4;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;"
    ),
    group!(
        "gcp-project",
        "Google Cloud: a project",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=2;dashed=0;fillColor=none;strokeColor=#4285F4;fontColor=#4285F4;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;"
    ),
    group!(
        "gcp-region",
        "Google Cloud: a region or zone",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=2;dashed=1;fillColor=none;strokeColor=#4285F4;fontColor=#4285F4;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;"
    ),
    group!(
        "k8s-namespace",
        "Kubernetes: a namespace",
        "rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#326CE5;fontColor=#326CE5;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;"
    ),
    group!(
        "k8s-cluster",
        "Kubernetes: a cluster",
        "rounded=0;whiteSpace=wrap;html=1;dashed=0;fillColor=none;strokeColor=#326CE5;fontColor=#326CE5;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;fontStyle=1;"
    ),
];

pub(super) const PRESETS: &[Preset] = &[
    Preset {
        id: "cloud-aws",
        title: "Cloud: AWS",
        about: "AWS services as the editor's own icons, in a cloud, region and VPC; left to right",
        direction: "LR",
        default_node: "aws-function",
        default_edge: "sync",
        nodes: &[
            "aws-user",
            "aws-client",
            "aws-internet",
            "aws-function",
            "aws-compute",
            "aws-container",
            "aws-kubernetes",
            "aws-database",
            "aws-nosql",
            "aws-cache",
            "aws-storage",
            "aws-queue",
            "aws-topic",
            "aws-events",
            "aws-stream",
            "aws-api",
            "aws-cdn",
            "aws-lb",
            "aws-dns",
            "aws-auth",
            "aws-secrets",
            "aws-waf",
        ],
        edges: &["sync", "async", "data", "both"],
        groups: &["aws-cloud", "aws-region", "aws-vpc", "boundary"],
    },
    Preset {
        id: "cloud-azure",
        title: "Cloud: Azure",
        about: "Azure services as the editor's own icons; left to right",
        direction: "LR",
        default_node: "az-app",
        default_edge: "sync",
        nodes: &[
            "az-users",
            "az-vm",
            "az-app",
            "az-function",
            "az-container",
            "az-kubernetes",
            "az-sql",
            "az-cosmos",
            "az-cache",
            "az-storage",
            "az-bus",
            "az-events",
            "az-grid",
            "az-logic",
            "az-api",
            "az-frontdoor",
            "az-gateway",
            "az-lb",
            "az-dns",
            "az-vnet",
            "az-vault",
            "az-monitor",
        ],
        edges: &["sync", "async", "data", "both"],
        groups: &["az-boundary", "boundary"],
    },
    Preset {
        id: "cloud-gcp",
        title: "Cloud: Google Cloud",
        about: "Google Cloud as boxes in a project and region (the editor draws Google's product icons from pictures, which a typed edit cannot place); left to right",
        direction: "LR",
        default_node: "service",
        default_edge: "sync",
        nodes: &[
            "actor", "client", "service", "database", "cache", "queue", "storage", "gateway",
            "worker", "external",
        ],
        edges: &["sync", "async", "data", "both"],
        groups: &["gcp-project", "gcp-region", "boundary"],
    },
    Preset {
        id: "k8s",
        title: "Kubernetes",
        about: "pods, services, ingress and volumes in namespaces of a cluster; top to bottom",
        direction: "TB",
        default_node: "k8s-pod",
        default_edge: "sync",
        nodes: &[
            "k8s-user",
            "k8s-ingress",
            "k8s-svc",
            "k8s-deploy",
            "k8s-pod",
            "k8s-sts",
            "k8s-job",
            "k8s-cronjob",
            "k8s-cm",
            "k8s-secret",
            "k8s-pvc",
            "k8s-node",
            "k8s-api",
        ],
        edges: &["sync", "async", "data", "depends"],
        groups: &["k8s-cluster", "k8s-namespace"],
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::model::Style;
    use crate::diagrams::shapes;

    #[test]
    fn every_icon_kind_names_a_shape_of_the_index() {
        for k in NODES {
            let key = k.shape.unwrap();
            let shape = shapes::lookup(key)
                .unwrap_or_else(|| panic!("{}: {key} is not in the shape index", k.name));
            assert!(!shape.style.contains('~'), "{key}");
            assert!(shape.w >= 20.0 && shape.h >= 20.0, "{key}");
        }
    }

    #[test]
    fn group_styles_are_whole_styles() {
        for g in GROUPS {
            let s = Style::parse(g.style);
            assert!(
                s.flag("container") || s.bare() == Some("swimlane"),
                "{}",
                g.name
            );
        }
    }
}
