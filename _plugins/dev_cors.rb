# jekyll serve --livereload returns non-HTML files before it applies webrick.headers, so the dev server never sends
# the Access-Control-Allow-Origin: * that GitHub Pages does, and the giscus iframe cannot load a template's giscus.css.
# Serve only: a build never calls Serve.setup.
module NebulosaDevCors
  module Servlet
    def do_GET(req, res)
      super.tap { res["Access-Control-Allow-Origin"] = "*" }
    end
  end

  module Setup
    def setup(destination)
      super.tap do
        servlet = Jekyll::Commands::Serve::Servlet
        servlet.prepend(Servlet) unless servlet < Servlet
      end
    end
  end
end

Jekyll::Commands::Serve.singleton_class.prepend(NebulosaDevCors::Setup) if defined?(Jekyll::Commands::Serve)
