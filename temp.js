// src/portals/CustomerPortal.tsx
import { Routes, Route } from "react-router-dom";
import MainLayout from "@/components/layout/MainLayout";
import Index from "@/pages/Index";
import Categories from "@/pages/Categories";
import CategoryDetail from "@/pages/CategoryDetail";
import ProductDetail from "@/pages/ProductDetail";
import Cart from "@/pages/Cart";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ResellerStorefront from "@/pages/ResellerStorefront";
import Account from "@/pages/Account";
import Orders from "@/pages/Orders";
import NotFound from "@/pages/NotFound";
function CustomerPortal() {
  return /* @__PURE__ */ React.createElement(MainLayout, null, /* @__PURE__ */ React.createElement(Routes, null, /* @__PURE__ */ React.createElement(Route, { path: "/", element: /* @__PURE__ */ React.createElement(Index, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/categories", element: /* @__PURE__ */ React.createElement(Categories, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/categories/:slug", element: /* @__PURE__ */ React.createElement(CategoryDetail, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/products/:id", element: /* @__PURE__ */ React.createElement(ProductDetail, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/cart", element: /* @__PURE__ */ React.createElement(Cart, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/cart/login", element: /* @__PURE__ */ React.createElement(Login, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/cart/register", element: /* @__PURE__ */ React.createElement(Register, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/store/:slug", element: /* @__PURE__ */ React.createElement(ResellerStorefront, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/account", element: /* @__PURE__ */ React.createElement(Account, null) }), /* @__PURE__ */ React.createElement(Route, { path: "/orders", element: /* @__PURE__ */ React.createElement(Orders, null) }), /* @__PURE__ */ React.createElement(Route, { path: "*", element: /* @__PURE__ */ React.createElement(NotFound, null) })));
}
export {
  CustomerPortal
};
