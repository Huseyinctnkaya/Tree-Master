import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const PAGES_QUERY = `#graphql
  query GetPages($query: String) {
    pages(first: 100, query: $query) {
      edges { node { id title handle } }
    }
  }
`;

const BLOGS_QUERY = `#graphql
  query GetBlogs($query: String) {
    blogs(first: 100, query: $query) {
      edges { node { id title handle } }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query GetArticles($query: String) {
    articles(first: 100, query: $query) {
      edges { node { id title handle blog { handle } } }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "page";
  const q = url.searchParams.get("q") ?? "";

  let resources: Array<{ id: string; title: string; url: string }> = [];

  if (type === "page") {
    const res = await admin.graphql(PAGES_QUERY, { variables: { query: q || undefined } });
    const data = await res.json();
    resources = (data.data?.pages?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      url: `/pages/${e.node.handle}`,
    }));
  } else if (type === "blog") {
    const res = await admin.graphql(BLOGS_QUERY, { variables: { query: q || undefined } });
    const data = await res.json();
    resources = (data.data?.blogs?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      url: `/blogs/${e.node.handle}`,
    }));
  } else if (type === "article") {
    const res = await admin.graphql(ARTICLES_QUERY, { variables: { query: q || undefined } });
    const data = await res.json();
    resources = (data.data?.articles?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      url: `/blogs/${e.node.blog.handle}/${e.node.handle}`,
    }));
  }

  return { resources };
};
