FROM ruby:3.2-slim

RUN apt-get update && apt-get install -y build-essential git && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/jekyll

COPY Gemfile* /srv/jekyll/
RUN bundle install

COPY . /srv/jekyll

EXPOSE 5000 35729

# Shell form to read the ports from the environment; exec so jekyll stays PID 1
# and still dies on SIGTERM.
CMD ["sh", "-c", "exec bundle exec jekyll serve --host 0.0.0.0 --port \"${JEKYLL_PORT:-5000}\" --livereload --livereload-port \"${JEKYLL_LIVERELOAD_PORT:-35729}\" --force_polling"]
