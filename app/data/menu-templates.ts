// Pre-built menu templates for common store types

export type TemplateItem = {
  title: string;
  type: string;
  url: string;
  items?: TemplateItem[];
};

export type MenuTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  items: TemplateItem[];
};

export const MENU_TEMPLATES: MenuTemplate[] = [
  {
    id: "fashion",
    name: "Fashion & Apparel",
    description: "Classic fashion store navigation with categories and account links",
    icon: "👗",
    items: [
      { title: "New Arrivals", type: "HTTP", url: "/collections/new-arrivals" },
      {
        title: "Women",
        type: "HTTP",
        url: "/collections/women",
        items: [
          { title: "Dresses", type: "HTTP", url: "/collections/dresses" },
          { title: "Tops", type: "HTTP", url: "/collections/tops" },
          { title: "Bottoms", type: "HTTP", url: "/collections/bottoms" },
          { title: "Outerwear", type: "HTTP", url: "/collections/outerwear" },
        ],
      },
      {
        title: "Men",
        type: "HTTP",
        url: "/collections/men",
        items: [
          { title: "Shirts", type: "HTTP", url: "/collections/shirts" },
          { title: "Pants", type: "HTTP", url: "/collections/pants" },
          { title: "Jackets", type: "HTTP", url: "/collections/jackets" },
        ],
      },
      { title: "Sale", type: "HTTP", url: "/collections/sale" },
      { title: "About Us", type: "HTTP", url: "/pages/about" },
      { title: "Contact", type: "HTTP", url: "/pages/contact" },
    ],
  },
  {
    id: "food",
    name: "Food & Beverage",
    description: "Perfect for restaurants, cafes, and specialty food stores",
    icon: "🍔",
    items: [
      { title: "Menu", type: "HTTP", url: "/pages/menu" },
      {
        title: "Shop",
        type: "CATALOG",
        url: "/collections/all",
        items: [
          { title: "Beverages", type: "HTTP", url: "/collections/beverages" },
          { title: "Snacks", type: "HTTP", url: "/collections/snacks" },
          { title: "Fresh Produce", type: "HTTP", url: "/collections/fresh" },
        ],
      },
      { title: "Our Story", type: "HTTP", url: "/pages/our-story" },
      { title: "Locations", type: "HTTP", url: "/pages/locations" },
      { title: "Order Online", type: "HTTP", url: "/collections/all" },
      { title: "Contact", type: "HTTP", url: "/pages/contact" },
    ],
  },
  {
    id: "tech",
    name: "Tech & Electronics",
    description: "Organized navigation for electronics and tech products",
    icon: "💻",
    items: [
      {
        title: "Computers",
        type: "HTTP",
        url: "/collections/computers",
        items: [
          { title: "Laptops", type: "HTTP", url: "/collections/laptops" },
          { title: "Desktops", type: "HTTP", url: "/collections/desktops" },
          { title: "Accessories", type: "HTTP", url: "/collections/computer-accessories" },
        ],
      },
      {
        title: "Mobile",
        type: "HTTP",
        url: "/collections/mobile",
        items: [
          { title: "Smartphones", type: "HTTP", url: "/collections/smartphones" },
          { title: "Cases & Covers", type: "HTTP", url: "/collections/phone-cases" },
          { title: "Chargers", type: "HTTP", url: "/collections/chargers" },
        ],
      },
      { title: "Deals", type: "HTTP", url: "/collections/deals" },
      { title: "Support", type: "HTTP", url: "/pages/support" },
      { title: "Blog", type: "BLOG", url: "/blogs/news" },
    ],
  },
  {
    id: "blog",
    name: "Blog & Content",
    description: "Content-first navigation for blogs and media sites",
    icon: "📝",
    items: [
      { title: "Home", type: "FRONTPAGE", url: "/" },
      { title: "Articles", type: "BLOG", url: "/blogs/articles" },
      {
        title: "Topics",
        type: "HTTP",
        url: "/blogs/all",
        items: [
          { title: "Lifestyle", type: "HTTP", url: "/blogs/lifestyle" },
          { title: "Travel", type: "HTTP", url: "/blogs/travel" },
          { title: "Food", type: "HTTP", url: "/blogs/food" },
          { title: "Tech", type: "HTTP", url: "/blogs/tech" },
        ],
      },
      { title: "About", type: "HTTP", url: "/pages/about" },
      { title: "Newsletter", type: "HTTP", url: "/pages/newsletter" },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean and simple — great starting point for any store",
    icon: "✨",
    items: [
      { title: "Home", type: "FRONTPAGE", url: "/" },
      { title: "Shop", type: "CATALOG", url: "/collections/all" },
      { title: "About", type: "HTTP", url: "/pages/about" },
      { title: "Contact", type: "HTTP", url: "/pages/contact" },
    ],
  },
  {
    id: "beauty",
    name: "Beauty & Wellness",
    description: "Curated navigation for beauty, skincare, and wellness brands",
    icon: "💄",
    items: [
      { title: "New In", type: "HTTP", url: "/collections/new-in" },
      {
        title: "Skincare",
        type: "HTTP",
        url: "/collections/skincare",
        items: [
          { title: "Cleansers", type: "HTTP", url: "/collections/cleansers" },
          { title: "Moisturizers", type: "HTTP", url: "/collections/moisturizers" },
          { title: "Serums", type: "HTTP", url: "/collections/serums" },
          { title: "SPF", type: "HTTP", url: "/collections/spf" },
        ],
      },
      {
        title: "Makeup",
        type: "HTTP",
        url: "/collections/makeup",
        items: [
          { title: "Face", type: "HTTP", url: "/collections/face-makeup" },
          { title: "Eyes", type: "HTTP", url: "/collections/eye-makeup" },
          { title: "Lips", type: "HTTP", url: "/collections/lip-products" },
        ],
      },
      { title: "Bundles", type: "HTTP", url: "/collections/bundles" },
      { title: "Our Blog", type: "BLOG", url: "/blogs/beauty-tips" },
      { title: "Rewards", type: "HTTP", url: "/pages/rewards" },
    ],
  },
];
